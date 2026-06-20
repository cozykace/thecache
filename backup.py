#!/usr/bin/env python3
"""Back up your data right now → backups/<timestamp>/. Stays 100% on this
machine. Run: python3 backup.py"""

import store

dest = store.backup(force=True)
print("✓ Backed up your data to:", dest)
print("  Tip: drag the 'backups' folder to an external drive or iCloud for")
print("  off-machine safety. Nothing leaves your Mac unless you move it.")
