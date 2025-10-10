#!/usr/bin/env python
import os
import sys


def main():
    # Updated to use the new config.settings module
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
