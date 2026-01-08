from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0034_add_automationreport_and_fk"),
    ]

    operations = [
        migrations.AddField(
            model_name="testcase",
            name="is_automation",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="testcase",
            name="attachment",
            field=models.FileField(blank=True, null=True, upload_to="testcases/attachments/"),
        ),
    ]
