export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  GUEST_PASSWORD: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  UPLOAD_DEADLINE: string;
}
