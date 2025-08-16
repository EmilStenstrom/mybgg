import logging

def setup_logging():
    """Set up logging configuration for the GameCache project."""

    # Set the logging level for specific libraries to WARNING to suppress DEBUG messages
    logging.getLogger("PIL").setLevel(logging.WARNING)
