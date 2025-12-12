
import { createRoute } from "@hono/zod-openapi";
import { jobs, createJob } from "../downloadJob.ts";
import { z } from "zod";

// Initiate download job
export const initiateRoute = createRoute({
	method: "post",
	path: "/v1/download/initiate",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ file_ids: z.array(z.number()).min(1) }),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Job created",
			content: {
				"application/json": {
					schema: z.object({ jobId: z.string(), status: z.string() }),
				},
			},
		},
	},
}, (c) => {
	const { file_ids } = c.req.valid("json");
	const job = createJob(file_ids);
	return c.json({ jobId: job.jobId, status: job.status });
});

// Check job status
export const statusRoute = createRoute({
	method: "get",
	path: "/v1/download/status/:jobId",
	responses: {
		200: {
			description: "Job status",
			content: {
				"application/json": {
					schema: z.object({ jobId: z.string(), status: z.string() }),
				},
			},
		},
		404: { description: "Job not found" },
	},
}, (c) => {
	const jobId = c.req.param("jobId");
	const job = jobs.get(jobId);
	if (!job) return c.json({ error: "Job not found" }, 404);
	return c.json({ jobId, status: job.status });
});

// Get job result
export const resultRoute = createRoute({
	method: "get",
	path: "/v1/download/:jobId",
	responses: {
		200: {
			description: "Job result",
			content: {
				"application/json": {
					schema: z.object({ jobId: z.string(), status: z.string(), result: z.any() }),
				},
			},
		},
		404: { description: "Job not found" },
	},
}, (c) => {
	const jobId = c.req.param("jobId");
	const job = jobs.get(jobId);
	if (!job) return c.json({ error: "Job not found" }, 404);
	return c.json({ jobId, status: job.status, result: job.result });
});
