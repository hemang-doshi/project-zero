.PHONY: build test
build:
	mkdir -p bin
	go build -o bin/zerod ./core/cmd/zerod
	go build -o bin/zero ./cli/cmd/zero
	go build -o bin/zero-simulator ./nodes/simulator
test:
	GOPROXY=off GOSUMDB=off go test -race ./...
	python3 -m unittest discover -s tests -p 'test_*.py'

.PHONY: firmware-test generate
firmware-test:
	bash tools/test-firmware.sh
generate:
	python3 tools/schema-gen.py
