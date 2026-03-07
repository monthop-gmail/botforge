.PHONY: build run-server run-chat clean

BINARY=gocode

build:
	go build -o $(BINARY) .

run-server: build
	./$(BINARY) serve

run-chat: build
	./$(BINARY) chat "$(MSG)"

clean:
	rm -f $(BINARY)
