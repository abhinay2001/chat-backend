export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpiresIn: "7d" as const,
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://chat:chat@localhost:5432/chat",
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:19092").split(","),
};
