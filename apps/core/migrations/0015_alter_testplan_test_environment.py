"""Make TestPlan.test_environment nullable to allow draft creation."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0014_alter_testplan_objective"),
    ]

    operations = [
        migrations.AlterField(
            model_name="testplan",
            name="test_environment",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("T", "Test Environment"),
                    ("PS", "Pre Staging Environment"),
                    ("S", "Staging Environment"),
                    ("UAT", "UAT Environment"),
                    ("P", "Production Environment"),
                ],
                blank=True,
                null=True,
            ),
        ),
    ]
