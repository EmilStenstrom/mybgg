import logging

def setup_logging():
    class ExcludeHTTPSConnectionFilter(logging.Filter):
        def filter(self, record):
            return "Starting new HTTPS connection" not in record.getMessage()

    # Set the logging level for specific libraries to WARNING to suppress DEBUG messages
    logging.getLogger("PIL").setLevel(logging.WARNING)
    logging.getLogger("requests_cache").setLevel(logging.WARNING)

    # Get the urllib3 logger
    urllib3_logger = logging.getLogger("urllib3.connectionpool")

    # Set the logging level to DEBUG to keep other debug messages
    urllib3_logger.setLevel(logging.DEBUG)

    # Add the custom filter to exclude specific messages
    urllib3_logger.addFilter(ExcludeHTTPSConnectionFilter())