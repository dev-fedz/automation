"""Ensure test_environment column is nullable at the DB level."""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0015_alter_testplan_test_environment"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
            ALTER TABLE core_testplan
            ALTER COLUMN test_environment DROP NOT NULL;
            """,
            reverse_sql="""
            ALTER TABLE core_testplan
            ALTER COLUMN test_environment SET NOT NULL;
            """,
        ),
    ]
