# One image for the ringing server and the mock phone.
#   docker build -t hearthline .               (runtime image)
#   docker build --target test -t hearthline-test .
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY src ./src
RUN pip install ".[server]" && useradd --create-home hearthline \
    && mkdir /data && chown hearthline /data
ENV HEARTHLINE_HOUSEHOLDS=/data/households.json \
    HEARTHLINE_KEYFILE=/data/device-key.json

# Test image: the same, plus pytest and the test suite.
FROM base AS test
RUN pip install pytest pytest-asyncio httpx
COPY tests ./tests
USER hearthline
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider"]

# Runtime image (the default, last stage).
FROM base AS runtime
USER hearthline
EXPOSE 8080
CMD ["hearthline-server", "run"]
