import mysql from "mysql2/promise";

export const db = mysql.createPool({
  host: "localhost",
  user: "u516388923_suratlppm",
  password: "N2/kFup?n",
  database: "u516388923_suratlppm",
  waitForConnections: true,
  connectionLimit: 10,
});