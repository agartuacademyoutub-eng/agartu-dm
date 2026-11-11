// Supabase Edge (Deno): Node глобалдары
import { Buffer } from 'node:buffer';
import process from 'node:process';
globalThis.Buffer ??= Buffer;
globalThis.process ??= process;
