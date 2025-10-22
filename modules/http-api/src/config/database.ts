import { createPool, Pool } from 'mysql2/promise';

const {
  MYSQL_HOST = 'localhost',
  MYSQL_PORT = '3306',
  MYSQL_DATABASE = 'qqbot_db',
  MYSQL_USER = 'qqbot_user',
  MYSQL_PASSWORD = 'qqbot_password',
  MYSQL_CONNECTION_LIMIT = '10'
} = process.env;

let pool: Pool | null = null;

export const getDatabasePool = (): Pool => {
  if (!pool) {
    pool = createPool({
      host: MYSQL_HOST,
      port: Number(MYSQL_PORT),
      database: MYSQL_DATABASE,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      waitForConnections: true,
      connectionLimit: Number(MYSQL_CONNECTION_LIMIT),
      queueLimit: 0,
      charset: 'utf8mb4_unicode_ci'
    });

    pool.on('connection', connection => {
      connection.query("SET NAMES utf8mb4");
    });
  }

  return pool;
};

export const closeDatabasePool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
