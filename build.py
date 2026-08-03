#!/usr/bin/env python3
"""
AKRAM Rugby Portal — data build script
========================================
Reads the roster Excel file (hand-edited by you) and regenerates the
site's data files in docs/data/. Run this every time you update the
spreadsheet, then commit + push docs/ to deploy.

Usage:
    python3 build.py path/to/roster.xlsx

You'll be prompted for the admin password (used to encrypt the full
roster for coach/admin viewing). It is NEVER stored in this script or
in any file that gets committed — only typed at build time.

Output (all written under docs/data/):
    cards.json              — public, non-sensitive card + filter data
    admin.enc.json          — full roster, encrypted with admin password
    players/<hash>.json     — one file per player, encrypted with that
                               player's own IC number as the key

SECURITY NOTE: this is client-side encryption for a static site with no
backend. It keeps casual viewers and search-engine crawlers out, and
stops anyone without the right password/IC from reading a record even
via browser dev tools. It is NOT equivalent to a real authenticated
backend — a sufficiently motivated attacker targeting one specific
child could attempt to brute-force that child's IC (IC numbers aren't
fully random). Treat this as "reasonable for a coaches/parents portal",
not as bank-grade security.
"""

import sys
import re
import json
import base64
import hashlib
import getpass
from pathlib import Path

import pandas as pd
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
import os

PBKDF2_ITERATIONS = 200_000
SALT_LEN = 16
KEY_LEN = 32  # AES-256

SHEET_NAME = "Form Responses 1"

UNIT_DISPLAY = {
    "FORWARD": "Forwards",
    "FORWARDS": "Forwards",
    "BACKLINES": "Backlines",
    "BACKLINE": "Backlines",
    "SCRUMHALF": "Scrum-half",
    "SCRUM-HALF": "Scrum-half",
    "MULTI-ROLE": "Multi-role",
    "MULTIROLE": "Multi-role",
}

POSITION_DISPLAY = {
    "WINGER": "Winger", "PROP": "Prop", "FLANKER": "Flanker",
    "INSIDE CENTRE": "Inside Centre", "OUTSIDE CENTRE": "Outside Centre",
    "LOCKS": "Locks", "SCRUMHALF": "Scrum-half", "FLYHALF": "Fly-half",
    "HOOKER": "Hooker", "FULL BACK": "Full Back", "BLIND WINGER": "Blind Winger",
}


def slugify(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", str(name).strip().lower())
    return re.sub(r"-+", "-", s).strip("-")


def digits_only(val) -> str:
    return re.sub(r"\D", "", str(val))


def age_group_from_tingkatan(val) -> str:
    m = re.match(r"\s*(\d+)", str(val))
    return f"{m.group(1)}Y" if m else ""


def clean_display_ic(digits: str) -> str:
    if len(digits) == 12:
        return f"{digits[0:6]}-{digits[6:8]}-{digits[8:12]}"
    return digits


def derive_key(secret: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_LEN,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(secret.encode("utf-8"))


def encrypt_payload(obj: dict, secret: str) -> dict:
    """Encrypt obj (as JSON) with AES-256-GCM, key derived via PBKDF2 from `secret`.
    Output format is directly compatible with the browser's SubtleCrypto:
    ciphertext already has the 16-byte GCM tag appended (both cryptography's
    AESGCM and Web Crypto's AES-GCM use this same convention)."""
    salt = os.urandom(SALT_LEN)
    iv = os.urandom(12)
    key = derive_key(secret, salt)
    aesgcm = AESGCM(key)
    plaintext = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    ciphertext = aesgcm.encrypt(iv, plaintext, None)
    return {
        "salt": base64.b64encode(salt).decode(),
        "iv": base64.b64encode(iv).decode(),
        "iterations": PBKDF2_ITERATIONS,
        "ciphertext": base64.b64encode(ciphertext).decode(),
    }


def validate(df: pd.DataFrame) -> list[str]:
    warnings = []
    dup_ic = df[df.duplicated(subset=["NOMBOR KAD PENGENALAN"], keep=False)]
    if len(dup_ic):
        warnings.append(f"Duplicate IC numbers found: {dup_ic['NAMA PENUH'].tolist()}")
    for _, row in df.iterrows():
        d = digits_only(row["NOMBOR KAD PENGENALAN"])
        if len(d) != 12:
            warnings.append(f"{row['NAMA PENUH']}: IC has {len(d)} digits (expected 12)")
    if df["NAMA PENUH"].isna().any():
        warnings.append("Some rows have a blank NAMA PENUH — check for empty form rows")
    return warnings


def build(xlsx_path: str, admin_password: str):
    df = pd.read_excel(xlsx_path, sheet_name=SHEET_NAME)
    df = df[df["NAMA PENUH"].notna()].reset_index(drop=True)

    warnings = validate(df)
    if warnings:
        print("\n⚠️  Data quality warnings (build will continue, but please check these):")
        for w in warnings:
            print(f"   - {w}")
        print()

    cards = []
    full_profiles = []
    seen_slugs = {}

    for _, row in df.iterrows():
        name = str(row["NAMA PENUH"]).strip()
        ic_digits = digits_only(row["NOMBOR KAD PENGENALAN"])
        ic_display = clean_display_ic(ic_digits)

        base_slug = slugify(name)
        n = seen_slugs.get(base_slug, 0)
        seen_slugs[base_slug] = n + 1
        slug = base_slug if n == 0 else f"{base_slug}-{n+1}"

        unit_raw = str(row.get("UNITS", "")).strip().upper()
        unit_display = UNIT_DISPLAY.get(unit_raw, unit_raw.title() if unit_raw and unit_raw != "NAN" else "")

        pos_raw = str(row.get("POSITION", "")).strip().upper()
        pos_display = POSITION_DISPLAY.get(pos_raw, pos_raw.title() if pos_raw and pos_raw != "NAN" else "")

        sec_pos_raw = str(row.get("SECONDARY POSITION", "")).strip().upper()
        sec_pos_display = POSITION_DISPLAY.get(sec_pos_raw, sec_pos_raw.title() if sec_pos_raw and sec_pos_raw != "NAN" else "")

        age_group = age_group_from_tingkatan(row.get("UMUR/TINGKATAN", ""))

        card = {
            "id": slug,
            "name": name,
            "nickname": str(row.get("NAMA SAMARAN", "")).strip() or None,
            "unit": unit_display or None,
            "position": pos_display or None,
            "secondaryPosition": sec_pos_display or None,
            "ageGroup": age_group or None,
            "tingkatan": str(row.get("UMUR/TINGKATAN", "")).strip() or None,
            "kelas": str(row.get("KELAS", "")).strip() or None,
            "photo": f"data/photos/{slug}.jpg",
        }
        cards.append(card)

        def val(col):
            v = row.get(col, "")
            if pd.isna(v):
                return None
            return str(v).strip() or None

        profile = {
            **card,
            "icNumber": ic_display,
            "dateOfBirth": val("TARIKH LAHIR"),
            "phoneNumber": val("NOMBOR TELEFON PEMAIN"),
            "address": val("ALAMAT RUMAH"),
            "heightCm": val("TINGGI (CM)"),
            "weightKg": val("BERAT (KG)"),
            "bloodGroup": val("KUMPULAN DARAH "),
            "allergies": val("ALAHAN "),
            "medicalHistory": val("SEJARAH PENYAKIT"),
            "medicalHistoryDetail": val("SEKIRANYA ADA, TERANGKAN SEJARAH PENYAKIT TERSEBUT "),
            "currentMedication": val("UBAT-UBATAN YANG MASIH DIAMBIL"),
            "currentMedicationDetail": val("SENARAIKAN NAMA UBAT-UBATAN YANG MASIH DIAMBIL (JIKA ADA)"),
            "guardian1Name": val("NAMA PENUH  IBU BAPA / PENJAGA 1"),
            "guardian1Ic": val("NOMBOR KAD PENGENALAN  IBU BAPA / PENJAGA 1"),
            "guardian1Phone": val("NO TELEFON IBU BAPA / PENJAGA 1"),
            "guardian1Work": val("PEKERJAAN / ALAMAT TEMPAT KERJA /NO TELEFON PEJABAT IBU BAPA / PENJAGA 1"),
            "guardian2Name": val("NAMA PENUH  IBU BAPA / PENJAGA 2"),
            "guardian2Ic": val("NOMBOR KAD PENGENALAN  IBU BAPA / PENJAGA 2"),
            "guardian2Phone": val("NO TELEFON IBU BAPA / PENJAGA 2"),
            "guardian2Work": val("PEKERJAAN / ALAMAT TEMPAT KERJA /NO TELEFON PEJABAT IBU BAPA / PENJAGA 2 (JIKA ADA)"),
            "otherEmergencyContacts": val(
                "EMERGENCY CONTACT DETAIL SELAIN YANG DI ATAS (SAUDARA MARA, JIRAN, MAJIKAN) SERTAKAN NAMA, HUBUNGAN DAN NO TELEFON YANG BOLEH DIHUBUNGI. ISIKAN BEBERAPA NAMA JIKA ADA\n\n(CONTOH: PAK ALI, DATUK, 0123456687)"
            ),
        }
        full_profiles.append((ic_digits, profile))

    out_dir = Path(__file__).parent / "docs" / "data"
    (out_dir / "players").mkdir(parents=True, exist_ok=True)
    (out_dir / "photos").mkdir(parents=True, exist_ok=True)

    # 1. Public card data — safe to be world-readable
    with open(out_dir / "cards.json", "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=2)

    # 2. Admin blob — full roster, encrypted with admin password
    admin_payload = {"players": [p for _, p in full_profiles]}
    with open(out_dir / "admin.enc.json", "w", encoding="utf-8") as f:
        json.dump(encrypt_payload(admin_payload, admin_password), f, indent=2)

    # 3. Per-player files — filename is sha256(ic digits), encrypted with that IC
    players_dir = out_dir / "players"
    for old in players_dir.glob("*.json"):
        old.unlink()
    for ic_digits, profile in full_profiles:
        if len(ic_digits) != 12:
            print(f"   ⚠️  Skipping per-player file for {profile['name']} — invalid IC, fix and rebuild")
            continue
        fname = hashlib.sha256(ic_digits.encode()).hexdigest() + ".json"
        with open(players_dir / fname, "w", encoding="utf-8") as f:
            json.dump(encrypt_payload(profile, ic_digits), f, indent=2)

    print(f"✅ Built {len(cards)} player cards")
    print(f"✅ Admin data encrypted -> docs/data/admin.enc.json")
    print(f"✅ {len(full_profiles)} per-player encrypted files -> docs/data/players/")
    print(f"\nPhotos: place each player's photo at docs/data/photos/<id>.jpg")
    print(f"        (see the \"photo\" field in cards.json for each player's exact id)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 build.py path/to/roster.xlsx")
        sys.exit(1)
    xlsx_path = sys.argv[1]
    pw = getpass.getpass("Set/confirm the ADMIN password (for coaches/staff): ")
    pw2 = getpass.getpass("Confirm admin password: ")
    if pw != pw2:
        print("Passwords didn't match. Try again.")
        sys.exit(1)
    if len(pw) < 6:
        print("Please use a password of at least 6 characters.")
        sys.exit(1)
    build(xlsx_path, pw)
