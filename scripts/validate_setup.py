#!/usr/bin/env python3
"""
Simple validation script to check if setup is correct before running the main script.
"""

import json
import sys
import requests
from pathlib import Path

def validate_config():
    """Validate the config.json file"""
    config_path = Path("config.json")

    if not config_path.exists():
        print("❌ config.json not found!")
        print("   Make sure you're running this from the mybgg directory")
        return False

    try:
        with open(config_path) as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        print("❌ config.json has invalid JSON syntax!")
        print(f"   Error: {e}")
        print("   Check for missing commas, extra quotes, etc.")
        return False

    # Check required fields
    required_fields = [
        ("project", "title"),
        ("boardgamegeek", "user_name"),
        ("github", "repo")
    ]

    for section, field in required_fields:
        if section not in config:
            print(f"❌ Missing section '{section}' in config.json")
            return False
        if field not in config[section]:
            print(f"❌ Missing field '{field}' in section '{section}'")
            return False

        value = config[section][field]
        if not value or "YOUR_" in str(value).upper():
            print(f"❌ Please replace placeholder in {section}.{field}")
            print(f"   Current value: {value}")
            return False

    print("✅ config.json looks good!")
    return True, config

def validate_bgg_user(username):
    """Check if BGG username exists and has a public collection"""
    print(f"🔍 Checking BGG user '{username}'...")

    try:
        # Check user exists
        url = f"https://boardgamegeek.com/xmlapi2/user?name={username}"
        response = requests.get(url, timeout=10)

        if response.status_code != 200:
            print(f"❌ BGG user '{username}' not found!")
            print("   Check your BGG username in config.json")
            return False

        # Check collection exists and is public
        url = f"https://boardgamegeek.com/xmlapi2/collection?username={username}&own=1"
        response = requests.get(url, timeout=10)

        if response.status_code != 200:
            print(f"❌ Cannot access collection for '{username}'")
            print("   Make sure your BGG collection is set to public")
            return False

        # Basic check for collection content
        if b"<item " in response.content:
            print(f"✅ BGG user '{username}' found with accessible collection!")
        else:
            print(f"⚠️  BGG user '{username}' found but collection appears empty")
            print("   Make sure you have games marked as 'owned' in your BGG collection")

        return True

    except requests.RequestException as e:
        print(f"❌ Error checking BGG user: {e}")
        print("   Check your internet connection")
        return False

def validate_python_deps():
    """Check if required Python packages are installed"""
    print("🔍 Checking Python dependencies...")

    # Read requirements from requirements.in file
    requirements_path = Path("scripts/requirements.in")
    if not requirements_path.exists():
        print("⚠️  requirements.in not found, using fallback package list")
        required_packages = [
            "requests",
            "requests_ratelimiter",
            "beautifulsoup4",
            "lxml"
        ]
    else:
        try:
            with open(requirements_path) as f:
                required_packages = []
                for line in f:
                    line = line.strip()
                    # Skip empty lines and comments
                    if line and not line.startswith('#'):
                        # Handle package names with version specifiers
                        package_name = line.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0]
                        required_packages.append(package_name.strip())
        except Exception as e:
            print(f"⚠️  Error reading requirements.in: {e}")
            print("   Using fallback package list")
            required_packages = [
                "requests",
                "requests_ratelimiter",
                "beautifulsoup4",
                "lxml"
            ]

    missing = []
    for package in required_packages:
        try:
            # Handle package names that import differently than their pip name
            import_name = package

            # Special cases for packages that import differently
            if package == "colorgram.py":
                import_name = "colorgram"
            elif package == "requests-cache":
                import_name = "requests_cache"
            elif "-" in package:
                import_name = package.replace("-", "_")
            elif "." in package and package != "colorgram.py":
                import_name = package.replace(".", "_")

            __import__(import_name)
        except ImportError:
            missing.append(package)

    if missing:
        print(f"❌ Missing Python packages: {', '.join(missing)}")
        print("   Run: pip install -r scripts/requirements.txt")
        return False

    print("✅ All Python dependencies are installed!")
    return True

def main():
    print("🧪 Validating MyBGG setup...\n")

    all_good = True

    # Validate config
    result = validate_config()
    if isinstance(result, tuple):
        config_valid, config = result
        all_good &= config_valid
    else:
        all_good = False
        return

    print()

    # Validate Python dependencies
    all_good &= validate_python_deps()
    print()

    # Validate BGG user
    if config_valid:
        bgg_username = config["boardgamegeek"]["user_name"]
        all_good &= validate_bgg_user(bgg_username)

    print("\n" + "=" * 50)

    if all_good:
        print("🎉 Setup validation passed!")
        print("You're ready to run: python scripts/download_and_index.py --cache_bgg")
    else:
        print("❌ Setup validation failed!")
        print("Please fix the issues above before running the main script.")
        sys.exit(1)


if __name__ == "__main__":
    main()
