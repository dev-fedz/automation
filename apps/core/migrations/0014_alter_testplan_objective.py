"""Make TestPlan.objective optional for draft creation."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_merge"),
    ]

    operations = [
        migrations.AlterField(
            model_name="testplan",
            name="objective",
            field=models.TextField(blank=True, default=""),
        ),
    ]
