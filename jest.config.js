// export default {
module.exports = {
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", {tsconfig: "test/tsconfig.json"}]
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
