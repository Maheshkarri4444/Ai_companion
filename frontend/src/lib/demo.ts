/**
 * Demo deployment only (docs/ARCHITECTURE.md D36): the admin login is intentionally public so reviewers can open the
 * admin console. After the review, rotate it (ADMIN_PASSWORD on the API host, then `npm run seed:admin`) and update
 * these values, or set them to empty strings to hide the box on the sign-in page.
 */
export const DEMO_ADMIN = {
  email: "admin@studycompanion.dev",
  password: "Admin#Study2026",
} as const;
