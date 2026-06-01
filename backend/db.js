// Dialect is chosen from DATABASE_URL so the same config works locally (SQLite)
// and on Render (Postgres) without any code changes.
import { Sequelize } from "sequelize";

const url = process.env.DATABASE_URL || "";
const isPostgres = url.startsWith("postgres://") || url.startsWith("postgresql://");

export const dbKind = isPostgres ? "postgres" : "sqlite";

const sequelize = isPostgres
  ? new Sequelize(url, {
      dialect: "postgres",
      logging: false,
      dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false },
      },
    })
  : new Sequelize({
      dialect: "sqlite",
      storage: process.env.SQLITE_PATH || "./data.sqlite",
      logging: false,
    });

export default sequelize;
