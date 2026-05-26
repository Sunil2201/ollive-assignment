FROM python:3.12-slim

WORKDIR /app

# Install the local SDK (backend's requirements.txt references it as -e ../../packages/sdk)
COPY packages/sdk /packages/sdk
RUN pip install --no-cache-dir /packages/sdk

# Install remaining backend dependencies, skipping the local -e SDK line
COPY apps/backend/requirements.txt ./requirements.txt
RUN grep -v "^-e" requirements.txt | pip install --no-cache-dir -r /dev/stdin

# Copy backend source
COPY apps/backend/ .

EXPOSE 5000
CMD ["python", "app.py"]