type LoginCodeProps = { code: string; magicLink: string };

export function LoginCode({ code, magicLink }: LoginCodeProps) {
  return (
    <div
      style={{
        color: "#3f2b46",
        margin: "16px auto",
        maxWidth: "600px",
        padding: "16px 0",
        fontFamily: "SF Pro Text",
      }}
    >
      <div
        style={{
          marginBottom: "16px",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <a href="https://nopal.build" target="_blank" rel="noopener noreferrer">
          <img
            src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTMxIiBoZWlnaHQ9IjU4IiB2aWV3Qm94PSIwIDAgMTMxIDU4IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0xMTUuNDEgMzguODc0NlY0NC4yOTczSDEzMVYzOC44NzQ2SDEyNi40MjVWMC45MTUwMzlIMTE1LjQxVjYuMzM3ODNIMTIwLjgzMlYzOC44NzQ2SDExNS40MVoiIGZpbGw9IiMzRjJCNDYiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTExNS41NzcgNDQuMjk3N0gxMDUuNzQ4VjQwLjRDMTA0LjA1NCA0MS41ODYzIDk5LjIwNzIgNDQuNjM2NiA5NC43MzM0IDQ0LjYzNjZDODkuMTQxMiA0NC42MzY2IDg1LjkyMTQgNDAuNTY5NSA4NS45MjE0IDM1LjQ4NTZDODUuOTIxNCAzMC40MDE4IDg5LjE0MTIgMjUuNjU2OCA5Ni4wODkxIDI1LjY1NjhDMTAxLjE3MyAyNS42NTY4IDEwNC43MzIgMjcuNjkwNCAxMDUuNDEgMjguMzY4MlYyMy4yODQzQzEwNS4wNzEgMjEuNzAyNyAxMDMuNTEyIDE4LjUzOTQgOTguNjMxIDE4LjUzOTRDOTMuNzUwNSAxOC41Mzk0IDkyLjM2MDkgMjAuOTExOSA5MS44NTI2IDIxLjkyODZMODYuNDI5OCAyMC40MDM1Qzg3LjQ0NjUgMTguMTQ0IDkxLjQxMiAxMy42MjUgOTkuMTM5NCAxMy42MjVDMTA2Ljg2NyAxMy42MjUgMTEwLjA0MSAxOC4zNjk5IDExMC42NjMgMjAuOTExOVYzOC44NzQ5SDExNS41NzdWNDQuMjk3N1pNMTA1LjMwOSAzNC4yMjY4QzEwNS4yOSAzNS40ODA0IDEwMy41NTkgMzcuNTIyNSA5OS4wNTk2IDM4LjQ4NTdDOTUuNTk3MyAzOS4yMjY4IDkxLjY4NzUgMzkuMzQxNyA5MS43NDM5IDM1LjY1MzJDOTEuODAwMyAzMS45NjQ3IDk0LjM0ODYgMzAuMTQ2NCA5OC4zNDM5IDMwLjYzN0MxMDIuMzM5IDMxLjEyNzcgMTA1LjMyOCAzMi45NzMyIDEwNS4zMDkgMzQuMjI2OFoiIGZpbGw9IiMzRjJCNDYiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTUwLjEyMTEgNTcuODU0VjUyLjQzMTNINTUuNTQzOVYxOS41NTU2SDUwLjQ2VjE0LjQ3MTdINjEuMzA1NlYxOC44Nzc4QzYyLjYwNDggMTcuMDcwMiA2Ni40OTExIDE0LjEzMjggNzEuNjQyOCAxNC4xMzI4Qzc4LjA4MjMgMTQuMTMyOCA4Ni4yMTY1IDE4LjE5OTkgODYuMjE2NSAyOS4yMTQ5Qzg2LjIxNjUgNDAuMjMgNzguMjUxOCA0NC45NzQ5IDcxLjY0MjggNDQuOTc0OUM2Ni4zNTU2IDQ0Ljk3NDkgNjIuNTQ4MyA0Mi4wMzc2IDYxLjMwNTYgNDAuNTY4OVY1Mi40MzEzSDY2LjcyODRWNTcuODU0SDUwLjEyMTFaTTcwLjc5NTIgMzkuODkxM0M3Ni4xMjk5IDM5Ljg5MTMgODAuNDU0NSAzNS4yNjMyIDgwLjQ1NDUgMjkuNTU0MUM4MC40NTQ1IDIzLjg0NTEgNzYuMTI5OSAxOS4yMTY5IDcwLjc5NTIgMTkuMjE2OUM2NS40NjA1IDE5LjIxNjkgNjEuMTM1OSAyMy44NDUxIDYxLjEzNTkgMjkuNTU0MUM2MS4xMzU5IDM1LjI2MzIgNjUuNDYwNSAzOS44OTEzIDcwLjc5NTIgMzkuODkxM1oiIGZpbGw9IiMzRjJCNDYiLz48cGF0aCBkPSJNNDQuMzExOCA0NC40ODFDNDAuMjAwMyA0NC4yNjI5IDM4LjMyNjMgNDIuODkzMyAzOC4yNTM4IDQxLjkzNjlDMzguMTc0OCA0MC44OTY0IDQwLjQ3NSAzOC45MzM3IDQzLjk0ODQgMzcuOTkzMkM0Ni45OTYgMzcuMTY4IDQ5LjY4OTcgMzguOTExNCA1MC40NTQ4IDQxLjM0OTRDNTEuMjE5OCA0My43ODc1IDQ3LjQ3NTYgNDQuNjQ4OCA0NC4zMTE4IDQ0LjQ4MVoiIGZpbGw9IiM1REEwNkQiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTQwLjU0NTkgMzcuMTc5N0M0Ni45MTAxIDM3LjE3OTcgNTIuMDY5MyAzMi4wMjA0IDUyLjA2OTMgMjUuNjU2MkM1Mi4wNjkzIDE5LjI5MiA0Ni45MTAxIDE0LjEzMjggNDAuNTQ1OSAxNC4xMzI4QzM0LjE4MTcgMTQuMTMyOCAyOS4wMjI1IDE5LjI5MiAyOS4wMjI1IDI1LjY1NjJDMjkuMDIyNSAzMi4wMjA0IDM0LjE4MTcgMzcuMTc5NyA0MC41NDU5IDM3LjE3OTdaTTQwLjU0NTcgMzEuNzU3MkM0My45MTUgMzEuNzU3MiA0Ni42NDY0IDI5LjAyNTggNDYuNjQ2NCAyNS42NTY2QzQ2LjY0NjQgMjIuMjg3MyA0My45MTUgMTkuNTU1OSA0MC41NDU3IDE5LjU1NTlDMzcuMTc2NCAxOS41NTU5IDM0LjQ0NTEgMjIuMjg3MyAzNC40NDUxIDI1LjY1NjZDMzQuNDQ1MSAyOS4wMjU4IDM3LjE3NjQgMzEuNzU3MiA0MC41NDU3IDMxLjc1NzJaIiBmaWxsPSIjM0YyQjQ2Ii8+PHBhdGggZD0iTTAuMDAwNDg4MjgxIDM4Ljg3NDNWNDQuMjk3MUgxNS43NjA1VjM4Ljg3NDNIMTAuODQ2MVYyMy4xMTQ0QzExLjUyMzkgMjIuMjY3MSAxNS43NjA1IDE5LjU1NTcgMTkuNDg4NiAxOS41NTU3QzIyLjQ3MTIgMTkuNTU1NyAyMy4wNDczIDIxLjU4OTIgMjMuMDQ3MyAyMy4xMTQ0TDIzLjIxNjggNDQuMjk3MUgzMy44OTI5VjM4Ljg3NDNIMjguNDcwMVYxOS44OTQ2QzI4LjQ3MDEgMTcuNjkxNiAyNS45MjgyIDEzLjc5MzkgMjEuMDEzOCAxMy43OTM5QzE3LjA4MjMgMTMuNzkzOSAxMi40ODQyIDE2Ljg0NDMgMTAuODQ2MSAxOC4wMzA1VjE0LjQ3MThIMC4wMDA0ODgyODFWMTkuNTU1N0g0LjkxNDg5VjM4Ljg3NDNIMC4wMDA0ODgyODFaIiBmaWxsPSIjM0YyQjQ2Ii8+PC9zdmc+"
            alt="nopal"
            width="131"
            height="58"
            style={{ display: "block" }}
          />
        </a>
        <div style={{ fontStyle: "italic" }}>
          <p style={{}}>We build for health.</p>
        </div>
      </div>
      <div
        style={{
          background: "#fff9f1",
          border: "1px solid #e5d6c5",
          padding: "16px",
          borderRadius: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "16px",
            gap: "8px",
            fontSize: "16px",
          }}
        >
          <span
            style={{
              color: "#7f5b8b",
            }}
          >
            Login Code:
          </span>
          <code
            style={{
              border: "1px solid #e5d6c5",
              background: "#fff",
              borderRadius: "4px",
              padding: "16px 8px",
            }}
          >
            {code}
          </code>
        </div>
        <div>
          You can also open a new tab by{" "}
          <a style={{ color: "#5da06d" }} href={magicLink}>
            clicking here to verify
          </a>
          .
        </div>
      </div>
    </div>
  );
}
