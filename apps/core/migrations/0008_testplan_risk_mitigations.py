from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_risk_models"),
    ]

    operations = [
        migrations.AddField(
            model_name="testplan",
            name="risk_mitigations",
            field=models.ManyToManyField(
                blank=True,
                related_name="test_plans",
                to="core.riskandmitigationplan",
            ),
        ),
    ]
