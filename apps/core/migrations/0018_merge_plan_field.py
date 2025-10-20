"""Merge migration to combine the new plan FK migration with existing leaf node.

This migration has no operations but resolves the migration graph conflict
detected while running tests.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0009_add_plan_field"),
        ("core", "0017_alter_testplan_test_tools_sql"),
    ]

    operations = []
