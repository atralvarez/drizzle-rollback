export default {
  dialect: "postgresql",
  out: "./drizzle",
  dbCredentials: { url: process.env.DRIZZLE_ROLLBACK_DEFINITELY_UNSET },
};
