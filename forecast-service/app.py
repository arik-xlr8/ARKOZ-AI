import logging
import math
import os
from datetime import datetime, timedelta
from threading import Lock
from typing import Protocol
from fastapi import FastAPI
from pydantic import BaseModel, Field, model_validator

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="CementOps Forecast Service", version="1.0.0")

class ForecastRequest(BaseModel):
    machineId: str = Field(min_length=1, max_length=100)
    metric: str = Field(min_length=1, max_length=100)
    timestamps: list[datetime] = Field(min_length=8, max_length=2048)
    values: list[float] = Field(min_length=8, max_length=2048)
    horizon: int = Field(default=24, ge=1, le=96)

    @model_validator(mode='after')
    def validate_series(self):
        if len(self.timestamps) != len(self.values) or not all(math.isfinite(x) for x in self.values):
            raise ValueError('Aligned timestamps and finite values required')
        if any(t.tzinfo is None for t in self.timestamps):
            raise ValueError('Timezone-aware timestamps required')
        steps = [(b-a).total_seconds() for a,b in zip(self.timestamps,self.timestamps[1:])]
        if steps[0] <= 0 or any(abs(s-steps[0]) > .001 for s in steps):
            raise ValueError('Strictly increasing, regular sampling required')
        return self

class BatchForecastRequest(BaseModel):
    requests: list[ForecastRequest] = Field(min_length=1, max_length=64)

class ForecastProvider(Protocol):
    name: str
    def predict(self, values: list[float], horizon: int) -> list[float]: ...
    def predict_many(self, values: list[list[float]], horizon: int) -> list[list[float]]: ...

class FallbackForecastProvider:
    name = 'linear-trend'
    def predict(self, values, horizon):
        recent = values[-16:]
        n = len(recent)
        center = (n-1)/2
        mean = sum(recent)/n
        slope = sum((i-center)*(v-mean) for i,v in enumerate(recent))/sum((i-center)**2 for i in range(n))
        # Ignore tiny oscillatory slopes, then damp distant extrapolation.
        if abs(slope) < max(abs(mean)*.0008, .0001):
            slope = 0
        return [round(max(0, values[-1]+slope*min(i,24)+slope*.25*max(0,i-24)),3) for i in range(1,horizon+1)]
    def predict_many(self, values, horizon):
        return [self.predict(series, horizon) for series in values]

class TimesFMForecastProvider:
    name = 'timesfm-2.5'
    def __init__(self):
        import timesfm
        self.model = timesfm.TimesFM_2p5_200M_torch.from_pretrained('google/timesfm-2.5-200m-pytorch')
        self.model.compile(timesfm.ForecastConfig(max_context=1024,max_horizon=128,normalize_inputs=True,use_continuous_quantile_head=False))
    def predict(self, values, horizon):
        return self.predict_many([values], horizon)[0]
    def predict_many(self, values, horizon):
        import numpy as np
        points, _ = self.model.forecast(
            horizon=horizon,
            inputs=[np.array(series[-1024:],dtype=np.float32) for series in values],
        )
        result = [[round(float(v),3) for v in row[:horizon]] for row in points]
        if len(result)!=len(values) or any(
            len(row)!=horizon or not all(math.isfinite(v) for v in row)
            for row in result
        ):
            raise ValueError('Invalid model forecast')
        return result

fallback = FallbackForecastProvider()
provider: ForecastProvider = fallback
fallback_reason = None
model_lock = Lock()
if os.getenv('FORECAST_PROVIDER','fallback') == 'timesfm':
    try:
        provider = TimesFMForecastProvider()
    except Exception:
        logging.exception('TimesFM unavailable; using linear trend')
        fallback_reason = 'TimesFM could not be loaded'

@app.get('/health')
def health():
    return {'status':'ok','provider':provider.name,'fallbackReason':fallback_reason}

def run_forecasts(requests: list[ForecastRequest]):
    grouped: dict[int, list[tuple[int, ForecastRequest]]] = {}
    for index, request in enumerate(requests):
        grouped.setdefault(request.horizon, []).append((index, request))
    results = [None] * len(requests)
    for horizon, group in grouped.items():
        used = provider
        reason = fallback_reason
        try:
            with model_lock:
                predicted = used.predict_many(
                    [request.values for _, request in group], horizon
                )
        except Exception:
            logging.exception('Model batch inference failed')
            used = fallback
            reason = 'TimesFM inference failed'
            predicted = fallback.predict_many(
                [request.values for _, request in group], horizon
            )
        for (index, request), values in zip(group, predicted):
            interval = request.timestamps[-1]-request.timestamps[-2]
            results[index] = {
                'machineId': request.machineId,
                'metric': request.metric,
                'model': used.name,
                'fallbackReason': reason,
                'forecast': [
                    {
                        'timestamp': (request.timestamps[-1]+interval*(i+1)).isoformat(),
                        'value': value,
                    }
                    for i, value in enumerate(values)
                ],
            }
    return results

@app.post('/forecast')
def forecast(request: ForecastRequest):
    return run_forecasts([request])[0]

@app.post('/forecast/batch')
def forecast_batch(request: BatchForecastRequest):
    return {'forecasts': run_forecasts(request.requests)}
