#!/usr/bin/env python3
"""
Simple script to check if the MyBGG website is working properly.
"""

import json
import requests
import sys
from pathlib import Path

def check_website():
    """Check if the MyBGG website is accessible and working"""

    # Load config to get repository info
    config_path = Path("config.json")
    if not config_path.exists():
        print("❌ config.json not found! Make sure you're in the mybgg directory.")
        return False

    try:
        with open(config_path) as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ config.json has invalid JSON: {e}")
        return False

    if "github" not in config or "repo" not in config["github"]:
        print("❌ github.repo not found in config.json")
        return False

    repo = config["github"]["repo"]
    username = repo.split("/")[0]

    website_url = f"https://{username}.github.io/mybgg"

    print(f"🔍 Checking website: {website_url}")

    try:
        response = requests.get(website_url, timeout=10)

        if response.status_code == 404:
            print("❌ Website not found (404)")
            print("   This usually means:")
            print("   • GitHub Pages is not enabled")
            print("   • GitHub Pages is still setting up (can take 15 minutes)")
            print("   • The repository name doesn't match the expected format")
            print(f"\n   To fix: Go to https://github.com/{repo}/settings/pages")
            print("   and enable GitHub Pages with Source: 'Deploy from a branch' and Branch: 'main'")
            return False

        elif response.status_code != 200:
            print(f"❌ Website returned error: {response.status_code}")
            print("   Try again in a few minutes - GitHub Pages might still be setting up")
            return False

        # Check if it's the MyBGG website
        if "mybgg" not in response.text.lower() and "boardgame" not in response.text.lower():
            print("⚠️  Website is accessible but doesn't look like MyBGG")
            print("   This might be a different GitHub Pages site")
            return False

        # Check if database is loading
        if "Loading database..." in response.text:
            print("✅ Website is accessible!")
            print("🔍 Checking database...")

            # Check if database file exists in releases
            database_url = f"https://github.com/{repo}/releases/latest/download/mybgg.sqlite.gz"
            db_response = requests.head(database_url, timeout=10)

            if db_response.status_code == 200:
                print("✅ Database file found!")
                print("   If the website shows 'Loading database...' it should work shortly.")
                print("   Try refreshing the page or waiting a few minutes.")
            else:
                print("❌ Database file not found")
                print("   You need to run: python scripts/download_and_index.py --cache_bgg")
                print("   This will create and upload your database.")
                return False
        else:
            print("✅ Website is accessible and appears to be working!")

        print(f"\n🌐 Your website: {website_url}")
        return True

    except requests.RequestException as e:
        print(f"❌ Error accessing website: {e}")
        print("   Check your internet connection and try again")
        return False

def main():
    print("🌐 Checking MyBGG website status...\n")

    success = check_website()

    print("\n" + "=" * 50)

    if success:
        print("🎉 Your MyBGG website appears to be working!")
    else:
        print("❌ Website check failed - see issues above")
        sys.exit(1)


if __name__ == "__main__":
    main()
