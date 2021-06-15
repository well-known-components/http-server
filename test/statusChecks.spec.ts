import { describeE2EWithStatusChecks } from "./test-e2e-express-server"
import { TestComponents, TestComponentsWithStatus } from "./test-helpers"

describeE2EWithStatusChecks("statusChecks", function ({ components }: { components: TestComponentsWithStatus }) {
  it("start was called", async () => {
    const { kafka } = components
    expect(kafka.didStart).toEqual(true)
  })

  it("/health/live", async () => {
    const { fetch } = components
    const res = await fetch.fetch("/health/live")
    expect(res.ok).toEqual(true)
  })

  it("/health/ready", async () => {
    const { fetch, kafka, database } = components
    const res = await fetch.fetch("/health/ready")
    expect(res.status).toEqual(503)
    expect(await res.json()).toEqual({
      details: {
        database: {
          status: "fail",
        },
        kafka: {
          status: "fail",
        },
        server: {
          status: "pass",
        },
      },
      status: "fail",
    })

    kafka.setReadynessProbe(Promise.resolve(true))

    {
      const res = await fetch.fetch("/health/ready")
      expect(res.ok).toEqual(false)
      expect(await res.json()).toEqual({
        details: {
          database: {
            status: "fail",
          },
          kafka: {
            status: "pass",
          },
          server: {
            status: "pass",
          },
        },
        status: "fail",
      })
    }
    database.setReadynessProbe(Promise.resolve(true))

    {
      const res = await fetch.fetch("/health/ready")
      expect(res.ok).toEqual(true)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({
        details: {
          database: {
            status: "pass",
          },
          kafka: {
            status: "pass",
          },
          server: {
            status: "pass",
          },
        },
        status: "pass",
      })
    }
  })

  it("/health/startup", async () => {
    const { fetch, kafka, database } = components

    {
      const res = await fetch.fetch("/health/startup")
      expect(res.ok).toEqual(false)
      expect(await res.json()).toEqual({
        details: {
          database: {
            status: "fail",
          },
          kafka: {
            status: "fail",
          },
          server: {
            status: "pass",
          },
        },
        status: "fail",
      })
    }

    kafka.setStartupProbe(Promise.resolve(true))

    {
      const res = await fetch.fetch("/health/startup")
      expect(res.ok).toEqual(false)
      expect(await res.json()).toEqual({
        details: {
          database: {
            status: "fail",
          },
          kafka: {
            status: "pass",
          },
          server: {
            status: "pass",
          },
        },
        status: "fail",
      })
    }
    database.setStartupProbe(Promise.resolve(true))

    {
      const res = await fetch.fetch("/health/startup")
      expect(res.ok).toEqual(true)
      expect(await res.json()).toEqual({
        details: {
          database: {
            status: "pass",
          },
          kafka: {
            status: "pass",
          },
          server: {
            status: "pass",
          },
        },
        status: "pass",
      })
    }
  })
})
