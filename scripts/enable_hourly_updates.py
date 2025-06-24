#!/usr/bin/env python3
"""
Script to enable automatic hourly updates via GitHub Actions.

This script extracts your GitHub token from local storage and automatically
creates it as a GitHub repository secret, enabling the GitHub Action workflow
to run every hour and update your board game collection database.
"""

import json
import sys
import base64
import os
from pathlib import Path

# Add the scripts directory to the path for imports
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

from mybgg.github_integration import _make_http_request, _make_http_post_json  # noqa: E402


def encrypt_secret(public_key: str, secret_value: str) -> str:
    """Encrypt a secret using the repository's public key."""
    try:
        import nacl.public
        import nacl.encoding
        
        # GitHub uses libsodium (NaCl) for encryption, not RSA
        # Decode the base64 public key
        public_key_bytes = base64.b64decode(public_key)
        
        # Create a NaCl public key
        public_key_nacl = nacl.public.PublicKey(public_key_bytes)
        
        # Create a sealed box (anonymous encryption)
        sealed_box = nacl.public.SealedBox(public_key_nacl)
        
        # Encrypt the secret
        encrypted = sealed_box.encrypt(secret_value.encode('utf-8'))
        
        # Return base64 encoded encrypted value
        return base64.b64encode(encrypted).decode('utf-8')
        
    except ImportError as e:
        if 'nacl' in str(e):
            print("❌ PyNaCl library not found.")
            print("Install it with: pip install pynacl")
        else:
            print("❌ Required libraries not found.")
            print("Install them with: pip install pynacl")
        sys.exit(1)


def get_repo_public_key(repo: str, token: str) -> dict:
    """Get the repository's public key for encrypting secrets."""
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    url = f'https://api.github.com/repos/{repo}/actions/secrets/public-key'
    response = _make_http_request(url, headers=headers)
    
    if not response:
        raise Exception("Failed to get repository public key")
    
    return response


def create_github_secret(repo: str, token: str, secret_name: str, secret_value: str):
    """Create or update a GitHub repository secret."""
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    }
    
    # Get the repository's public key
    print(f"🔍 Getting public key for {repo}...")
    public_key_data = get_repo_public_key(repo, token)
    print(f"✅ Got public key (key_id: {public_key_data['key_id']})")
    
    # Encrypt the secret value
    print("🔐 Encrypting secret value...")
    encrypted_value = encrypt_secret(public_key_data['key'], secret_value)
    print("✅ Secret encrypted successfully")
    
    # Create the secret
    url = f'https://api.github.com/repos/{repo}/actions/secrets/{secret_name}'
    data = {
        'encrypted_value': encrypted_value,
        'key_id': public_key_data['key_id']
    }
    
    print(f"📡 Making PUT request to: {url}")
    
    # Make the request manually to get better error handling
    import urllib.request
    import urllib.error
    
    try:
        request = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers)
        request.get_method = lambda: 'PUT'
        
        with urllib.request.urlopen(request, timeout=30) as response:
            response_data = response.read()  # noqa: F841
            print("✅ Secret created/updated successfully!")
            return True
            
    except urllib.error.HTTPError as e:
        error_response = e.read().decode('utf-8')
        print(f"❌ HTTP {e.code}: {e.reason}")
        print(f"📄 Error details: {error_response}")
        
        # Parse the error response if it's JSON
        try:
            error_json = json.loads(error_response)
            if 'message' in error_json:
                print(f"� GitHub says: {error_json['message']}")
            if 'errors' in error_json:
                print("💡 Validation errors:")
                for error in error_json['errors']:
                    print(f"   - {error}")
        except json.JSONDecodeError:
            pass
            
        raise Exception(f"HTTP {e.code}: {e.reason}")
    except Exception as e:
        print(f"❌ Request failed: {e}")
        raise


def get_repo_from_config() -> str | None:
    """Get the repository name from config.ini."""
    config_file = Path(__file__).parent.parent / 'config.ini'
    
    if not config_file.exists():
        return None
    
    try:
        with open(config_file, 'r') as f:
            content = f.read()
        
        for line in content.split('\n'):
            line = line.strip()
            if line.startswith('github_repo'):
                # Extract value after =
                parts = line.split('=', 1)
                if len(parts) == 2:
                    repo = parts[1].strip()
                    # Remove quotes if present
                    repo = repo.strip('"\'')
                    if repo and repo != 'YOUR_GITHUB_USERNAME/mybgg':
                        return repo
        
        return None
    except Exception:
        return None

def main():
    token_file = Path.home() / '.mybgg' / 'token.json'

    if not token_file.exists():
        print("❌ No token file found at ~/.mybgg/token.json")
        print("Please run the download script first to authenticate with GitHub:")
        print("  python scripts/download_and_index.py --debug")
        print("\nThis will authenticate you with GitHub and save the token locally.")
        print("Then run this script again to enable hourly updates.")
        sys.exit(1)

    try:
        with open(token_file, 'r') as f:
            token_data = json.load(f)

        if 'access_token' not in token_data:
            print("❌ Token file exists but doesn't contain access_token")
            sys.exit(1)

        token = token_data['access_token']
        print("✅ Found GitHub token!")
        
        # Try to get repository from config
        repo = get_repo_from_config()
        
        if repo:
            print(f"✅ Found repository: {repo}")
            print(f"\n🔄 Creating GitHub secret 'MYBGG_GITHUB_TOKEN' in {repo}...")

            try:
                create_github_secret(repo, token, 'MYBGG_GITHUB_TOKEN', token)
                print("✅ Successfully created GitHub secret!")
                print("\n🎉 Hourly updates are now enabled!")
                print("Your board game collection will be automatically updated every hour.")
                print("You can test it by going to the Actions tab in your repository.")
            except Exception as e:
                print(f"❌ Failed to create GitHub secret: {e}")
                print("\nFalling back to manual setup...")
                show_manual_instructions(token)
        else:
            print("⚠️  Could not determine repository from config.ini")
            show_manual_instructions(token)

    except Exception as e:
        print(f"❌ Error reading token file: {e}")
        sys.exit(1)


def show_manual_instructions(token: str):
    """Show manual setup instructions."""
    print(f"\nToken: {token}")
    print("\nManual setup steps:")
    print("1. Copy the token above")
    print("2. Go to your GitHub repository settings")
    print("3. Navigate to Settings > Secrets and variables > Actions")
    print("4. Click 'New repository secret'")
    print("5. Name: MYBGG_GITHUB_TOKEN")
    print("6. Value: paste the token")
    print("7. Click 'Add secret'")


if __name__ == "__main__":
    main()
