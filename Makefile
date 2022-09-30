
ifneq ($(CI), true)
LOCAL_ARG = --local --verbose --diagnostics
endif

ifeq ($(INSPECT), true)
INSPECT = --inspect --inspect-brk
endif

build:
	./node_modules/.bin/tsc -p tsconfig.json
	rm -rf node_modules/@microsoft/api-extractor/node_modules/typescript || true
	./node_modules/.bin/api-extractor run $(LOCAL_ARG) --typescript-compiler-folder ./node_modules/typescript

test:
	./node_modules/.bin/jest --forceExit --detectOpenHandles --coverage --verbose $(TEST_FILE)

test-esm:
	node --experimental-vm-modules ./node_modules/.bin/jest --forceExit --detectOpenHandles --coverage --verbose

ci: | build test test-esm

bench: build
	$(MAKE) bench-op DISABLE_EXPRESS=false TEST_NAME=express-test
	$(MAKE) bench-op DISABLE_EXPRESS=true  TEST_NAME=http-test
	$(MAKE) bench-op UWS=true							 TEST_NAME=uwp-test

bench-op:
	DISABLE_EXPRESS=$(DISABLE_EXPRESS) UWS=$(UWS) node --prof dist/benchmark.js &
	@echo '> Initializing server...'
	@sleep 5
	# prewarm
	ab -k -c 100 -n 100 http://0.0.0.0:5000/ping
	# real benchmark
	ab -e benchmark_$(TEST_NAME).csv -g gnuplot -l -k -c 100 -n 10000 http://0.0.0.0:5000/ping
	@sleep 1
	# node --prof-process isolate-0xnnnnnnnnnnnn-v8.log > processed.txt

update-interfaces-next:
	npm install @well-known-components/interfaces@next

update-interfaces-latest:
	npm install @well-known-components/interfaces@latest

.PHONY: build test testy