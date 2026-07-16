// Side-effect module: load .env.local BEFORE any other import (e.g. lib/db)
// evaluates process.env. Import this first in standalone scripts.
// (dotenv does not override variables already present in the environment, so
// this is safe when the env is injected externally, e.g. by setup.ps1.)
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
