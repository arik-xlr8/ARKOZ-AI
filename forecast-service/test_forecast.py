import unittest
from fastapi.testclient import TestClient
from app import app, FallbackForecastProvider

class ForecastTests(unittest.TestCase):
    def test_constant(self):
        self.assertEqual(FallbackForecastProvider().predict([3.0]*16,4),[3.0]*4)
    def test_trend(self):
        values=FallbackForecastProvider().predict(list(range(16)),4)
        self.assertEqual(values,[16,17,18,19])
    def test_api_validation_and_timestamps(self):
        c=TestClient(app)
        body={'machineId':'motor','metric':'vibration','timestamps':[f'2026-09-08T0{i}:00:00Z' for i in range(8)],'values':list(range(8)),'horizon':4}
        r=c.post('/forecast',json=body)
        self.assertEqual(r.status_code,200)
        self.assertEqual(len(r.json()['forecast']),4)
        self.assertTrue(r.json()['forecast'][0]['timestamp'].startswith('2026-09-08T08:00'))
        self.assertNotIn('confidence',r.json())
        body['timestamps'][1]=body['timestamps'][0]
        self.assertEqual(c.post('/forecast',json=body).status_code,422)
        body['horizon']=1000
        self.assertEqual(c.post('/forecast',json=body).status_code,422)
    def test_batch_forecast_preserves_request_order(self):
        c=TestClient(app)
        timestamps=[f'2026-09-08T0{i}:00:00Z' for i in range(8)]
        requests=[
            {'machineId':'motor','metric':'vibration','timestamps':timestamps,'values':[3.0]*8,'horizon':4},
            {'machineId':'fan','metric':'temperature','timestamps':timestamps,'values':list(range(8)),'horizon':4},
        ]
        r=c.post('/forecast/batch',json={'requests':requests})
        self.assertEqual(r.status_code,200)
        forecasts=r.json()['forecasts']
        self.assertEqual([item['machineId'] for item in forecasts],['motor','fan'])
        self.assertEqual([len(item['forecast']) for item in forecasts],[4,4])
