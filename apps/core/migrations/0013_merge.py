"""Merge migration to resolve conflicting leaf nodes.

This migration depends on the two conflicting leaf migrations so the
migration graph has a single merge point. It contains no operations.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_alter_apirun_collection"),
        ("core", "0012_apirequest_body_raw_type"),
    ]

    operations = []
