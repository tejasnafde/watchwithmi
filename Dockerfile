FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies.
# gcc was only needed to build libtorrent from source; that dependency is no
# longer installed (see requirements.txt), so the toolchain is dropped too.
# curl stays for the HEALTHCHECK.
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY static/ ./static/

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser && chown -R appuser:appuser /app
USER appuser

# Cloud Run injects the listening port via $PORT and ignores EXPOSE; 8000 is
# only the local default.
ENV PORT=8000
EXPOSE 8000

# Health check — hits the JSON /health endpoint so a partially-initialized
# app that still serves the HTML index (via GET /) gets caught. See bug
# #06 in docs/polishing/06-deployment-scaling.md.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f "http://localhost:${PORT}/health" || exit 1

# Run the application using Gunicorn for production.
#
# --workers 1 because Socket.IO room state is in-memory (per-process). On
# Cloud Run this MUST be paired with --max-instances=1, or two users in the
# same room can land on different instances and never see each other.
#
# Shell form so ${PORT} expands. --timeout 600 keeps long-lived WebSocket and
# streaming responses from being reaped by gunicorn's worker timeout.
CMD exec gunicorn app.main:socket_app \
    --workers 1 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind "0.0.0.0:${PORT}" \
    --timeout 600