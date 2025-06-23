import json
import os
import requests
import time
import webbrowser
import logging
from pathlib import Path
from typing import Optional, Dict, Any


logger = logging.getLogger(__name__)


class GitHubAuth:
    """Handles GitHub OAuth Device Flow authentication."""

    def __init__(self, client_id: str):
        self.client_id = client_id
        self.token_file = Path.home() / '.mybgg' / 'token.json'
        self.token_file.parent.mkdir(exist_ok=True)

    def get_access_token(self) -> str:
        """Get a valid access token, refreshing if necessary."""
        # Try to load existing token
        token_data = self._load_token()
        if token_data and self._is_token_valid(token_data):
            return token_data['access_token']

        # Need to authenticate
        logger.info("No valid token found, starting OAuth Device Flow...")
        return self._perform_device_flow()

    def _load_token(self) -> Optional[Dict[str, Any]]:
        """Load token from local storage."""
        try:
            if self.token_file.exists():
                with open(self.token_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load token: {e}")
        return None

    def _save_token(self, token_data: Dict[str, Any]):
        """Save token to local storage with proper permissions."""
        try:
            with open(self.token_file, 'w') as f:
                json.dump(token_data, f)
            # Set file permissions to 0600 (owner read/write only)
            os.chmod(self.token_file, 0o600)
            logger.info(f"Token saved to {self.token_file}")
        except Exception as e:
            logger.error(f"Failed to save token: {e}")
            raise

    def _is_token_valid(self, token_data: Dict[str, Any]) -> bool:
        """Check if the token is still valid by making a test API call."""
        try:
            headers = {'Authorization': f"token {token_data['access_token']}"}
            response = requests.get('https://api.github.com/user', headers=headers, timeout=10)
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"Token validation failed: {e}")
            return False

    def _perform_device_flow(self) -> str:
        """Perform the complete OAuth Device Flow."""
        # Step 1: Request device and user codes
        device_response = requests.post(
            'https://github.com/login/device/code',
            data={
                'client_id': self.client_id,
                'scope': 'public_repo'  # Request permission to create releases on public repos
            },
            headers={'Accept': 'application/json'},
            timeout=10
        )
        device_response.raise_for_status()
        device_data = device_response.json()

        # Step 2: Show user code and open browser
        user_code = device_data['user_code']
        verification_uri = device_data['verification_uri']

        print(f"\nPlease visit: {verification_uri}")
        print(f"And enter the code: {user_code}")
        print("Opening browser...")

        try:
            webbrowser.open(verification_uri)
        except Exception as e:
            logger.warning(f"Failed to open browser: {e}")

        # Step 3: Poll for access token
        device_code = device_data['device_code']
        interval = device_data.get('interval', 5)
        expires_in = device_data.get('expires_in', 900)

        print(f"Waiting for authorization... (timeout in {expires_in // 60} minutes)")

        start_time = time.time()
        while time.time() - start_time < expires_in:
            time.sleep(interval)

            token_response = requests.post(
                'https://github.com/login/oauth/access_token',
                data={
                    'client_id': self.client_id,
                    'device_code': device_code,
                    'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'
                },
                headers={'Accept': 'application/json'},
                timeout=10
            )

            if token_response.status_code != 200:
                continue

            token_data = token_response.json()

            if 'access_token' in token_data:
                logger.info("Authorization successful!")
                self._save_token(token_data)
                return token_data['access_token']
            elif token_data.get('error') == 'authorization_pending':
                continue
            elif token_data.get('error') == 'slow_down':
                interval += 5
                continue
            else:
                raise Exception(f"OAuth error: {token_data.get('error_description', 'Unknown error')}")

        raise Exception("OAuth Device Flow timed out")


class GitHubReleaseManager:
    """Manages GitHub releases and assets."""

    def __init__(self, repo: str, token: str):
        self.repo = repo  # format: owner/repo
        self.token = token
        self.headers = {
            'Authorization': f'token {token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        self.base_url = 'https://api.github.com'

    def upload_snapshot(self, file_path: str, tag: str = 'snapshot', asset_name: str = 'mybgg.sqlite.gz'):
        """Upload a file as a snapshot release asset."""
        logger.info(f"Uploading {file_path} to GitHub release {tag}")

        # Step 1: Find or create release
        release = self._find_or_create_release(tag)

        # Step 2: Delete existing asset if it exists
        self._delete_existing_asset(release, asset_name)

        # Step 3: Upload new asset
        self._upload_asset(release, file_path, asset_name)

        # Return the public download URL
        download_url = f"https://github.com/{self.repo}/releases/latest/download/{asset_name}"
        logger.info(f"Upload successful! Download URL: {download_url}")
        return download_url

    def _find_or_create_release(self, tag: str) -> Dict[str, Any]:
        """Find existing release or create a new one."""
        # Try to find existing release
        url = f"{self.base_url}/repos/{self.repo}/releases/tags/{tag}"
        response = requests.get(url, headers=self.headers, timeout=10)

        if response.status_code == 200:
            logger.info(f"Found existing release: {tag}")
            return response.json()
        elif response.status_code == 404:
            # Create new release
            logger.info(f"Creating new release: {tag}")
            create_url = f"{self.base_url}/repos/{self.repo}/releases"
            release_data = {
                'tag_name': tag,
                'name': 'Board Game Collection Database',
                'body': 'Latest database of board game collection from BoardGameGeek',
                'draft': False,
                'prerelease': False
            }
            create_response = requests.post(create_url, json=release_data, headers=self.headers, timeout=10)
            create_response.raise_for_status()
            return create_response.json()
        else:
            response.raise_for_status()
            # This should never be reached due to raise_for_status, but added for type safety
            return {}

    def _delete_existing_asset(self, release: Dict[str, Any], asset_name: str):
        """Delete existing asset with the same name."""
        for asset in release.get('assets', []):
            if asset['name'] == asset_name:
                logger.info(f"Deleting existing asset: {asset_name}")
                delete_url = f"{self.base_url}/repos/{self.repo}/releases/assets/{asset['id']}"
                delete_response = requests.delete(delete_url, headers=self.headers, timeout=10)
                delete_response.raise_for_status()
                break

    def _upload_asset(self, release: Dict[str, Any], file_path: str, asset_name: str):
        """Upload asset to release."""
        upload_url = release['upload_url'].replace('{?name,label}', f'?name={asset_name}')

        with open(file_path, 'rb') as f:
            file_data = f.read()

        upload_headers = self.headers.copy()
        upload_headers['Content-Type'] = 'application/gzip'

        logger.info(f"Uploading {len(file_data):,} bytes...")
        upload_response = requests.post(
            upload_url,
            data=file_data,
            headers=upload_headers,
            timeout=60
        )
        upload_response.raise_for_status()
        logger.info("Asset upload successful!")


def setup_github_integration(settings: Dict[str, Any]) -> GitHubReleaseManager:
    """Set up GitHub integration with OAuth Device Flow authentication."""
    github_config = settings['github']

    # Use OAuth Device Flow for automatic authentication
    # Public client ID for the MyBGG OAuth App
    public_client_id = "Ov23lir5tLSaSrWi0YMJ"

    logger.info("Using OAuth Device Flow for automatic authentication")
    print("\n🔐 Setting up GitHub authentication...")
    print("This will open your browser to authenticate with GitHub (no manual token creation needed!)")

    auth = GitHubAuth(public_client_id)
    token = auth.get_access_token()
    return GitHubReleaseManager(github_config['repo'], token)
