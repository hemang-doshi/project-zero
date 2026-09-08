.PHONY: build test
build:
	mkdir -p bin
	go build -o bin/zerod ./core/cmd/zerod
	go build -o bin/zero ./cli/cmd/zero
	go build -o bin/zero-simulator ./nodes/simulator
test:
	GOPROXY=off GOSUMDB=off go test -race ./...
