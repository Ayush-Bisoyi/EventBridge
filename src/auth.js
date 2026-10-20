import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE_NAME = 'eventbridge_viewer';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const safeEqual = (left, right) => {
  const a = Buffer.from(left ?? '');
  const b = Buffer.from(right ?? '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const signatureFor = (value) => crypto
  .createHmac('sha256', config.sessionSecret)
  .update(value)
  .digest('base64url');

const makeSession = () => {
  const issuedAt = Math.floor(Date.now() / 1000).toString();
  const value = `${issuedAt}.viewer`;
  return `${value}.${signatureFor(value)}`;
};

const parseCookies = (header = '') => Object.fromEntries(header
  .split(';')
  .map((part) => part.trim().split('='))
  .filter(([key, value]) => key && value)
  .map(([key, ...rest]) => [key, decodeURIComponent(rest.join('='))]));

export const isViewer = (req) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return false;
  const [issuedAt, role, signature] = token.split('.');
  if (!issuedAt || role !== 'viewer' || !signature) return false;
  const age = Math.floor(Date.now() / 1000) - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_MAX_AGE_SECONDS) return false;
  return safeEqual(signature, signatureFor(`${issuedAt}.${role}`));
};

export const requireViewer = (req, res, next) => {
  if (!isViewer(req)) return res.status(401).json({ error: 'Viewer authentication required' });
  return next();
};

export const loginViewer = (res) => {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(makeSession())}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`
  );
};

export const logoutViewer = (res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
};

export const verifyAdminPassword = (password) => safeEqual(password, config.adminPassword);

export const verifyWebhookSecret = (provided) => safeEqual(provided, config.webhookSecret);

export const verifyInternalToken = (provided) => safeEqual(provided, config.sessionSecret);

