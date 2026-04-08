import Fastify from "fastify";

const app = Fastify();

app.get("/", async () => {
  return { status: "OK 🚀 Server hidup" };
});

app.listen({ port: process.env.PORT || 3000, host: "0.0.0.0" });
