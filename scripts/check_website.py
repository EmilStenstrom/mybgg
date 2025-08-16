#!/usr/bin/env python3
"""
Simple script to check if the GameCache website is working properly.
"""

import sys
from pathlib import Path

# Add the scripts directory to the path so we can import gamecache modules
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Now import after path is set
from gamecache.config import parse_config_file  # noqa: E402
from gamecache.http_client import make_http_request  # noqa: E402

def check_website():
    """Check if the GameCache website is accessible and working"""

    # Load config to get repository info
    config_path = Path("config.ini")
    if not config_path.exists():
        print("❌ config.ini not found! Make sure you're in the GameCache directory.")
        return False

    try:
        config = parse_config_file("config.ini")
    except Exception as e:
        print(f"❌ config.ini has invalid syntax: {e}")
        return False

    if "github_repo" not in config:
        print("❌ github_repo not found in config.ini")
        return False

    repo = config["github_repo"]
    username = repo.split("/")[0]

    website_url = f"https://{username}.github.io/gamecache"

    print(f"🔍 Checking website: {website_url}")

    try:
        response = make_http_request(website_url, timeout=10)
        response_text = response.decode('utf-8', errors='ignore')

        # Check if it's the GameCache website
        if "gamecache" not in response_text.lower() and "boardgame" not in response_text.lower():
            print("⚠️  Website is accessible but doesn't look like GameCache")
            print("   This might be a different GitHub Pages site")
            return False

        # Check if database is loading
        if "Loading database..." in response_text:
            print("✅ Website is accessible!")
            print("🔍 Checking database...")

            # Check if database file exists in releases (just try to get first few bytes)
            database_url = f"https://github.com/{repo}/releases/latest/download/gamecache.sqlite.gz"
            try:
                make_http_request(database_url, timeout=10)
                print("✅ Database file found!")
                print("   If the website shows 'Loading database...' it should work shortly.")
                print("   Try refreshing the page or waiting a few minutes.")
            except Exception:
                print("❌ Database file not found")
                print("   You need to run: python scripts/download_and_index.py --cache_bgg")
                print("   This will create and upload your database.")
                return False
        else:
            print("✅ Website is accessible and appears to be working!")

        print(f"\n🌐 Your website: {website_url}")
        return True

    except Exception as e:
        print(f"❌ Error accessing website: {e}")
        print("   Check your internet connection and try again")
        return False

def main():
    print("🌐 Checking GameCache website status...\n")

    success = check_website()

    print("\n" + "=" * 50)

    if success:
        print("🎉 Your GameCache website appears to be working!")
    else:
        print("❌ Website check failed - see issues above")
        sys.exit(1)


if __name__ == "__main__":
    main()
