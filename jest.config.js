// export default {
module.exports = {
  globals: {
    "ts-jest": {
      tsconfig: "test/tsconfig.json",
      useESM: true
    },
  },
  moduleFileExtensions: ["ts", "js"],
  // extensionsToTreatAsEsm: [".ts"],
  // preset: "ts-jest/presets/default-esm",
  preset: "ts-jest",
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "src/**/*.js", "!src/benchmark.ts",],
  testMatch: ["**/*.spec.(ts)"],
  testEnvironment: "node",
}