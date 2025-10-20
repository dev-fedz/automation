from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0008_testplan_risk_mitigations"),
    ]

    operations = [
        migrations.AddField(
            model_name="riskandmitigationplan",
            name="plan",
            field=models.ForeignKey(
                to="core.testplan",
                on_delete=django.db.models.deletion.CASCADE,
                related_name="risk_mitigation_links",
                null=True,
                blank=True,
            ),
        ),
    ]
