import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const [output, ...extra] = process.argv.slice(2)
const pepper = process.env.AUTH_PEPPER
const password = process.env.STORE_USER_PASSWORD
const email = process.env.STORE_USER_EMAIL?.trim().toLowerCase()
const username = process.env.STORE_USER_USERNAME?.trim().toLowerCase()
const name = process.env.STORE_USER_NAME?.trim() || 'HENRA Demo Admin'

if (!output || extra.length || !pepper || pepper.length < 32
  || !password || password.length < 12 || password.length > 256
  || !email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  || (username && !/^[a-z0-9._-]{1,80}$/.test(username))
  || name.length > 150 || [email, name].some((value) => value.includes('\0'))) {
  process.stderr.write('Usage: npm run provision:sql -- <new-file.generated.sql>\n'
    + 'Set AUTH_PEPPER, STORE_USER_EMAIL and STORE_USER_PASSWORD in the environment. '
    + 'STORE_USER_NAME and STORE_USER_USERNAME are optional.\n')
  process.exit(2)
}

const salt = randomBytes(16)
const input = createHmac('sha256', pepper).update('password-v1\0' + password).digest()
const hash = pbkdf2Sync(input, salt, 100000, 32, 'sha256')
const packed = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${hash.toString('base64url')}`
const literal = (value) => value ? "'" + value.replaceAll("'", "''") + "'" : 'NULL'
const sql = `INSERT INTO users (name, email, username, password_hash, role_id, active)
VALUES (${literal(name)}, ${literal(email)}, ${literal(username)}, ${literal(packed)}, 1, 1)
ON CONFLICT (email) DO NOTHING;
`
writeFileSync(output, sql, { flag: 'wx', mode: 0o600 })
process.stdout.write('Provisioning SQL generated. Keep the file private and remove it after application.\n')
