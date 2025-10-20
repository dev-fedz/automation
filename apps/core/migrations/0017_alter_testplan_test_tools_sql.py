"""Ensure database column for test_tools is nullable at DB level.

This migration uses raw SQL because previous AlterField migrations did not
remove the NOT NULL constraint in some environments.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0016_alter_testplan_test_environment_sql"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
            ALTER TABLE core_testplan ALTER COLUMN test_tools_id DROP NOT NULL;
            """,
            reverse_sql="""
            ALTER TABLE core_testplan ALTER COLUMN test_tools_id SET NOT NULL;
            """,
        )
    ]
