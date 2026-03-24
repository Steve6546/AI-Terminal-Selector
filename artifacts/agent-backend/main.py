import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("AGENT_BACKEND_PORT", "9000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
