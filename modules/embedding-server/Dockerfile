# syntax=docker/dockerfile:1.7

ARG LLAMA_CPP_VERSION=b7472

FROM debian:bookworm-slim AS build
ARG LLAMA_CPP_VERSION
WORKDIR /src

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
    libcurl4-openssl-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --branch ${LLAMA_CPP_VERSION} --depth 1 https://github.com/ggml-org/llama.cpp.git .

RUN cmake -S . -B build \
    -DBUILD_SHARED_LIBS=OFF \
    -DLLAMA_CURL=ON \
    -DGGML_NATIVE=OFF \
    -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build --target llama-server -j"$(nproc)"

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libcurl4 \
    libgomp1 \
    libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/build/bin/llama-server /usr/local/bin/llama-server
COPY entrypoint.sh /usr/local/bin/embedding-entrypoint.sh

RUN chmod +x /usr/local/bin/embedding-entrypoint.sh \
  && mkdir -p /models

ENV MODEL_URL=https://huggingface.co/ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/resolve/main/embeddinggemma-300m-qat-Q8_0.gguf?download=true
ENV MODEL_PATH=/models/embeddinggemma-300m-qat-Q8_0.gguf
ENV SERVER_PORT=8080

VOLUME ["/models"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=15s --start-period=45s --retries=3 \
  CMD curl -fsS -X POST http://127.0.0.1:${SERVER_PORT}/v1/embeddings \
    -H 'Content-Type: application/json' \
    -d '{"model":"embeddinggemma-300m","input":"healthcheck"}' >/dev/null || exit 1

CMD ["/usr/local/bin/embedding-entrypoint.sh"]
