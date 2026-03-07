FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY adkcode/ /app/adkcode/
COPY plugins/ /app/adkcode/plugins/
COPY api.py /app/api.py

RUN mkdir -p /workspace

EXPOSE 8000
WORKDIR /workspace
CMD ["python", "/app/api.py"]
