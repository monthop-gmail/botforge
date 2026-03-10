FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash && rm -rf /var/lib/apt/lists/* && \
    git config --global user.name "Gemini" && \
    git config --global user.email "gemini@google.com" && \
    git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

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
