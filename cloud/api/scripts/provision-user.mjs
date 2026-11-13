import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [output, option, keyFile, ...extra] = process.argv.slice(2)
const generated = option === '--access-key-file' && Boolean(keyFile)
const pepper = process.env.AUTH_PEPPER
const password = process.env.STORE_USER_PASSWORD
const email = process.env.STORE_USER_EMAIL?.trim().toLowerCase()
const username = process.env.STORE_USER_USERNAME?.trim().toLowerCase()
const name = process.env.STORE_USER_NAME?.trim() || 'مسؤول متجر هلال'

if (!output || (option && !generated) || extra.length || !pepper || pepper.length < 32
  || (generated && (password || resolve(output) === resolve(keyFile)))
  || (!generated && (!password || password.length < 12 || password.length > 256 || /^hilal-ak1_[a-zA-Z0-9_-]{43}$/.test(password)))
  || !email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  || (username && !/^[a-z0-9._-]{1,80}$/.test(username))
  || name.length > 150 || [email, name].some((value) => value.includes('\0'))) {
  process.stderr.write('Usage: npm run provision:sql -- <new-file.generated.sql> [--access-key-file <new-private-file.generated.key>]\n'
    + 'Set AUTH_PEPPER and STORE_USER_EMAIL. Set STORE_USER_PASSWORD for password mode or leave it unset for key mode. '
    + 'STORE_USER_NAME and STORE_USER_USERNAME are optional.\n')
  process.exit(2)
}

const salt = randomBytes(16)
const encodedSalt = salt.toString('base64url')
const key = generated ? 'hilal-ak1_' + randomBytes(32).toString('base64url') : null
const packed = key
  ? `hmac-sha256$1$${encodedSalt}$${createHmac('sha256', pepper).update(`access-key-v1\0${encodedSalt}\0${key}`).digest('base64url')}`
  : `pbkdf2-sha256$100000$${encodedSalt}$${pbkdf2Sync(
    createHmac('sha256', pepper).update('password-v1\0' + password).digest(), salt, 100000, 32, 'sha256',
  ).toString('base64url')}`
const literal = (value) => value ? "'" + value.replaceAll("'", "''") + "'" : 'NULL'
const sql = `INSERT INTO users (name, email, username, password_hash, role_id, active)
VALUES (${literal(name)}, ${literal(email)}, ${literal(username)}, ${literal(packed)}, 1, 1)
ON CONFLICT (email) DO NOTHING;
`
if (existsSync(output) || (key && existsSync(keyFile))) throw new Error('Use new private output file paths.')
if (key) writeFileSync(keyFile, key + '\n', { flag: 'wx', mode: 0o600 })
try {
  writeFileSync(output, sql, { flag: 'wx', mode: 0o600 })
} catch (error) {
  if (key) unlinkSync(keyFile)
  throw error
}
process.stdout.write(key
  ? 'Provisioning SQL and a separate private access-key file generated. Keep both out of Git.\n'
  : 'Provisioning SQL generated. Keep the file private and remove it after application.\n')
