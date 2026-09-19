// Expected editing failures are explicit values, so the caller can explain them.
export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });
