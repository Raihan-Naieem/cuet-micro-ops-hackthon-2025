1. Architecture Diagram (Option A: Polling)
   The system uses a Single-Process Asynchronous Polling pattern. Instead of external infrastructure, we utilize Node.js's non-blocking event loop and in-memory storage to handle concurrency.

Diagram Description:
Client: Sends HTTP requests
API server: Handles the request and immediately responds.
In-Memory stores:A local variable (const jobs = {} ) acting as the database.
Background Worker: An async function running inside the server process that peroms the simulation.
Diagram:
sequenceDiagram
participant Client
participant API as Express Server
participant Worker as Background Function
participant Memory as In-Memory Store

    Note over Client, API: 1. Initiation
    Client->>API: POST /v1/download/start
    API->>Memory: Create Job { status: "queued" }
    API->>Worker: Trigger startWorker() (No Await)
    API-->>Client: Return 202 Accepted + jobId

    Note over Worker, Memory: 2. Background Processing
    Worker->>Memory: Update status: "processing"
    loop Simulation Steps
        Worker->>Worker: Wait (Sleep)
        Worker->>Memory: Update progress %
    end
    Worker->>Memory: Update status: "done" + result

    Note over Client, API: 3. Polling Loop
    loop Every 2s
        Client->>API: GET /v1/download/status/:id
        API->>Memory: Read Job State
        API-->>Client: Return JSON { status, progress }
    end

    Note over Client, API: 4. Completion
    Client->>API: GET /v1/download/:id
    API-->>Client: Return File Content

Data flow:
1.Start:
The Client sends a POST request to /v1/download/start with the file ID.

        The API Server generates a unique jobId and saves a new job object (status: "queued") into the global jobs object (In-Memory Store).

        The Server immediately responds with HTTP 202 and the jobId to the client, preventing any timeout.
    2.Process:
        Simultaneously, the Server triggers the startWorker() function without awaiting it.

        This "Worker" function runs in the background. It changes the job status in memory to "processing".

        The Worker enters a loop (simulating 10s-120s delay), updating the progress field in the jobs object every few seconds.

        Upon completion, the Worker updates the status to "done" and saves the simulated file content to the result field.
    3.Poll(The Loop):
        The Client sends a GET request to /v1/download/status/:jobId every 2 seconds.

        The API Server looks up the jobId in the jobs object and returns the current status and progress.

        Once the status is "done", the Client stops polling.
    4.Finish:
        The Client requests /v1/download/:jobId.

        The API Server verifies the job is done and streams the stored result content back to the Client.

2.Our Approach
The pattern we selected: Option A(polling pattern)
Why we chose: We have chosen the Polling Pattern to solve the long-running download challenge. This involves the client initiating a request and then sending periodic requests (every 2-3 seconds) to check the status until the job is complete.

Justification behind our approach:
1.Solves the Timeout Problem: The API returns a 202 Accepted response immediately (typically <20ms). The 10-120 second delay happens in the background, ensuring the reverse proxy (Cloudflare/Nginx) never times out.

    2.Proxy Compatibility: Zero Infrastructure Overhead: By using a JavaScript object as the data store and the Node.js Event Loop for processing, we eliminate the need for Redis, Databases, or external Queues.

    3.Ease of Implementation: The entire logic is contained within the application layer, making it easy to deploy and debug during the hackathon.

Why we didnt choose:
Option B(WebSockets/SSE):
Reason:
Complexity: WebSockets require maintaining persistent connections. If the connection drops (due to unstable WiFi or proxy timeouts), the client loses the progress stream and needs complex reconnection logic.

        Proxy Risk: Many reverse proxies (like Nginx default configs) have their own read timeouts that can kill idle WebSocket connections, re-introducing the very problem we are trying to solve. Polling is standard HTTP and works everywhere guaranteed.

    Option C(Webhooks):
        Reason:
        Incompatible Client: Webhooks are designed for Server-to-Server communication. Our client is a Web Browser/Frontend, which cannot receive a POST callback from the server. This pattern is technically impossible for a standard browser client.

    Option D(Hybrid):
        Reason:
        Over-Engineering: Building a Hybrid system (Polling + WebSockets) doubles the implementation effort. Given the hackathon time constraints, a pure Polling solution provides 100% of the required functionality with 50% of the code.
