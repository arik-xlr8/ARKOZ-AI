FROM python:3.12-slim
WORKDIR /app
COPY forecast-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY forecast-service .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
