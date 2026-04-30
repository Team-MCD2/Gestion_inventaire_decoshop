/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Timestamp (ms) auquel la session courante expire. */
    authExpiresAt?: number;
    /** Timestamp (ms) auquel la session courante a été ouverte. */
    authIssuedAt?: number;
  }
}
