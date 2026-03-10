FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN go mod tidy && go build -o gocode .

FROM alpine:3.20

RUN apk add --no-cache bash git curl github-cli && \
    git config --global user.name "Gocode" && \
    git config --global user.email "gocode@bot" && \
    git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

WORKDIR /workspace
COPY --from=builder /app/gocode /usr/local/bin/gocode

EXPOSE 4096
ENTRYPOINT ["gocode"]
CMD ["serve"]
